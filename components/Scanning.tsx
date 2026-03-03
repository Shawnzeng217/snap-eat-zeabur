
import React, { useEffect, useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import Tesseract from 'tesseract.js';
import { Dish, Language, ScanType } from '../types';

interface ScanningProps {
  uploadedImage: string | null;
  targetLanguage: Language;
  scanType: ScanType;
  onCancel: () => void;
  onComplete: (results: Dish[], isMenu: boolean) => void;
}

export const Scanning: React.FC<ScanningProps> = ({ uploadedImage, targetLanguage, scanType, onCancel, onComplete }) => {
  const [progress, setProgress] = useState(0);
  // Initialize status text based on scan type
  const [statusText, setStatusText] = useState(
    scanType === 'menu' ? "Scanning Menu..." : "Analyzing Dish..."
  );

  // Helper to convert blob URL to Base64
  const urlToBase64 = async (url: string): Promise<string> => {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        // Remove the data URL prefix (e.g., "data:image/jpeg;base64,")
        const base64Data = base64String.split(',')[1];
        resolve(base64Data);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  useEffect(() => {
    let isMounted = true;
    let progressInterval: NodeJS.Timeout;

    const analyzeImage = async () => {
      if (!uploadedImage) return;

      try {
        // Start visual progress
        // We'll cap it at 80% during analysis, then jump to 90% for image loading, then 100%
        progressInterval = setInterval(() => {
          setProgress(prev => {
            if (prev >= 80) return prev;
            if (prev < 30) return prev + 3;
            if (prev < 70) return prev + 1;
            return prev + 0.3;
          });
        }, 100);

        setProgress(10);
        setStatusText("Analyzing image & text...");

        // 1. Prepare Image
        const base64Image = await urlToBase64(uploadedImage);

        // 2. Initialize Gemini
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || process.env.API_KEY || "" });
        // Note: Using import.meta.env.VITE_API_KEY is preferred in Vite, fallbacks for older setup

        // 3. Define Schema (Updated for Root Object with isMenu)
        const responseSchema = {
          type: Type.OBJECT,
          properties: {
            isMenu: { type: Type.BOOLEAN, description: "True if the image is a menu (text list), False if it is a photo of real food." },
            dishes: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING, description: `Name of the dish translated to ${targetLanguage}` },
                  originalName: { type: Type.STRING, description: "Original name of the dish in its native language" },
                  englishName: { type: Type.STRING, description: "Name of the dish in English (for image search purposes)" },
                  description: { type: Type.STRING, description: `Description of ingredients and taste profile in ${targetLanguage}` },
                  tags: { type: Type.ARRAY, items: { type: Type.STRING }, description: `Top 3 dominant flavor profile words (e.g. Sweet, Salty, Umami) in ${targetLanguage}` },
                  allergens: { type: Type.ARRAY, items: { type: Type.STRING }, description: `List 1 to 5 potential allergens (e.g. Peanuts, Gluten, Dairy, Shellfish) in ${targetLanguage}` },
                  spiceLevel: { type: Type.STRING, enum: ["None", "Mild", "Medium", "Hot"], description: "None=Not Spicy, Mild=1 chili, Medium=2 chilies, Hot=3 chilies" },
                  category: { type: Type.STRING, description: "Broad category like Soup, Main, Dessert" },
                  boundingBox: { type: Type.ARRAY, items: { type: Type.NUMBER }, description: "Bounding box of the dish [ymin, xmin, ymax, xmax] in 0-1000 scale." }
                },
                required: ["name", "originalName", "englishName", "description", "tags", "allergens", "spiceLevel", "category", "boundingBox"]
              }
            }
          },
          required: ["isMenu", "dishes"]
        };

        // 5. Construct Prompt with Accuracy Optimization
        const accuracyPrompt = scanType === 'menu'
          ? "ACCURACY RULE: Since this is a menu (text), you CANNOT see the food. You MUST infer 'spiceLevel', 'allergens', and 'tags' solely based on your CULINARY KNOWLEDGE of the dish name. Do not guess visual features."
          : "ACCURACY RULE: Infer 'spiceLevel' and 'allergens' based on VISUAL INSPECTION of the food.";

        // --- PARALLEL EXECUTION: AI + MANDATED OCR ---

        // A. Start Gemini Analysis (Focus on DISH IDENTIFICATION)
        const geminiPromise = ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64Image } },
              {
                text: `Analyze this menu image. 
                                 Identify all distinct dishes. 
                                 Translate details to ${targetLanguage}.
                                 
                                 IMPORTANT: Return PURE JSON adhering to the schema.
                                 - 'originalName': The exact text as it appears on the menu (e.g., "宫保鸡丁").
                                 - 'description': Brief English description.
                                 - 'price': Price if available.
                                 - 'spiceLevel': 'None', 'Mild', 'Medium', 'Hot'.
                                 - 'category': e.g., 'Appetizer', 'Main', 'Dessert'.
                                 - 'tags': Array of strings like "Spicy", "Vegetarian".
                                 - 'boundingBox': [0,0,0,0] (Placeholder, we will use OCR for location).
                                 
                                 ${accuracyPrompt}`
              }
            ]
          },
          config: {
            responseMimeType: "application/json",
            responseSchema: responseSchema
          }
        });

        // B. Start OCR (MANDATORY for Commercial-Grade Accuracy)
        const ocrPromise = Tesseract.recognize(
          uploadedImage,
          'chi_sim+eng',
          { logger: (m: any) => { } }
        ).catch((e: any) => {
          console.error("OCR Failed:", e);
          return null;
        });

        // Wait for both results
        const [geminiResponse, ocrResult] = await Promise.all([geminiPromise, ocrPromise]);

        // 6. Parse Gemini Result
        let jsonText = geminiResponse.text || "{}";
        if (jsonText.startsWith('```')) {
          jsonText = jsonText.replace(/^```json\s?/, '').replace(/^```\s?/, '').replace(/```$/, '');
        }

        const parsedData = JSON.parse(jsonText);
        let dishesList = parsedData.dishes || [];
        const isMenu = parsedData.isMenu || false;

        // --- COMMERCIAL-GRADE OCR MATCHING LOGIC ---
        if (isMounted) setStatusText("Refining locations...");

        if (ocrResult && ocrResult.data && ocrResult.data.lines) {

          const img = new Image();
          img.src = uploadedImage;
          await new Promise(r => img.onload = r);
          const imgW = img.naturalWidth;
          const imgH = img.naturalHeight;

          dishesList = dishesList.map((dish: any) => {
            const normName = dish.originalName.replace(/\s+/g, '').toLowerCase(); // e.g. "kungpaochicken"

            // Find BEST matching line(s)
            let bestMatch: any = null;
            let bestScore = 0;

            ocrResult.data.lines.forEach((line: any) => {
              const normLine = line.text.replace(/\s+/g, '').toLowerCase();

              // 1. Exact Substring Match (High Confidence)
              if (normLine.includes(normName) || normName.includes(normLine)) {
                const matchLen = Math.min(normLine.length, normName.length);
                const maxLen = Math.max(normLine.length, normName.length);
                let score = matchLen / maxLen;

                // Boost score if the lengths are very similar (it's the WHOLE line)
                if (Math.abs(normLine.length - normName.length) < 3) score += 0.2;

                if (score > bestScore) {
                  bestScore = score;
                  bestMatch = line;
                }
              }
            });

            if (bestMatch && bestScore > 0.4) {
              const { bbox } = bestMatch; // { x0, y0, x1, y1 }

              return {
                ...dish,
                isOcrRefined: true,
                boundingBox: [
                  (bbox.y0 / imgH) * 1000,
                  (bbox.x0 / imgW) * 1000,
                  (bbox.y1 / imgH) * 1000,
                  (bbox.x1 / imgW) * 1000
                ]
              };
            }

            return { ...dish };
          });
        }

        // 7. Process dishes & Preload Images
        if (isMounted) {
          const processedDishes = await Promise.all(dishesList.map(async (dish: any, index: number) => {
            // SWITCH TO SEARCH: Use Bing Thumbnail API (Hotlinking)
            // This searches the internet for real photos which is faster (instant) and more realistic than AI generation.
            // We combine Original Name + English Name + "Food" for best accuracy.
            const searchQuery = `${dish.originalName || ''} ${dish.englishName || dish.name} food dish`.trim();

            let imageUrl;

            // For menus, try to find an image. For identified food photos, use the source.
            if (isMenu || scanType === 'menu') {
              imageUrl = `https://tse2.mm.bing.net/th?q=${encodeURIComponent(searchQuery)}&w=400&h=400&c=7&rs=1&p=0`;
            } else {
              // Reconstruct the Base64 Data URL for the DB if it's a food scan
              imageUrl = `data:image/jpeg;base64,${base64Image}`;
            }

            return {
              ...dish,
              id: Date.now().toString() + index,
              image: imageUrl,
              isMenu: isMenu
            };
          }));

          // Preload images
          if ((isMenu || scanType === 'menu') && processedDishes.length > 0) {
            const imagePromises = processedDishes.map((dish: any) => {
              return new Promise<void>((resolve) => {
                if (!dish.image) { resolve(); return; }
                const img = new Image();
                img.onload = () => resolve();
                img.onerror = () => resolve();
                img.src = dish.image;
              });
            });
            // Max wait 3s
            const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, 3000));
            await Promise.race([Promise.all(imagePromises), timeoutPromise]);
          }

          if (isMounted) {
            setProgress(100);
            setTimeout(() => {
              if (isMounted) onComplete(processedDishes as Dish[], isMenu || (scanType === 'menu')); // Fix types
            }, 300);
          }
        }

      } catch (error: any) {
        console.error("AI/OCR Error:", error);
        if (isMounted) {
          if (error.message?.includes('429') || error.message?.includes('Quota') || error.status === 'RESOURCE_EXHAUSTED') {
            setStatusText("Gemini API Quota Exceeded. Please try again later.");
            setTimeout(onCancel, 5000);
          } else {
            setStatusText("Error scanning. Try again.");
            setTimeout(onCancel, 3000);
          }
          setProgress(0);
        }
      } finally {
        if (progressInterval!) clearInterval(progressInterval);
      }
    };

    analyzeImage();

    return () => {
      isMounted = false;
      if (progressInterval!) clearInterval(progressInterval);
    };
  }, [uploadedImage, targetLanguage, scanType, onComplete, onCancel]); // useEffect dependencies

  return (
    <div className="relative flex h-full w-full flex-col justify-between overflow-hidden bg-background-light dark:bg-background-dark">
      <div className="flex flex-col items-center justify-center flex-grow px-6 w-full mx-auto">

        {/* Visual Scanner */}
        <div className="relative flex items-center justify-center mb-10 select-none pointer-events-none">
          <div className="absolute w-72 h-72 rounded-full border border-primary/10 animate-ping" style={{ animationDuration: '3s' }}></div>
          <div className="absolute w-80 h-80 rounded-full border border-primary/5 animate-pulse"></div>

          <div className="relative w-64 h-64 rounded-full overflow-hidden shadow-2xl shadow-primary/20 border-8 border-white dark:border-[#3a261c] bg-gray-100 dark:bg-gray-800 z-10">
            <div
              className="absolute inset-0 bg-cover bg-center opacity-90"
              style={{ backgroundImage: `url('${uploadedImage || "https://picsum.photos/400/400"}')` }}
            ></div>
            <div className="absolute inset-0 bg-primary/20 mix-blend-overlay"></div>
            <div className="absolute top-0 left-0 w-full h-1 bg-white/80 shadow-[0_0_20px_rgba(255,255,255,0.9)] z-20 animate-[scan_2s_ease-in-out_infinite]" style={{ top: '50%' }}></div>
          </div>
        </div>

        {/* Text */}
        <div className="flex flex-col items-center gap-3 text-center mb-10">
          <h2 className="text-[#181310] dark:text-white tracking-tight text-[28px] font-bold leading-tight px-4 animate-[pulse_2s_infinite]">
            {statusText}
          </h2>
          <p className="text-[#181310]/60 dark:text-[#f8f6f5]/60 text-base font-normal leading-normal max-w-[280px]">
            {scanType === 'menu'
              ? `Reading menu text and translating to ${targetLanguage}.`
              : `Identifying flavors and allergens in ${targetLanguage}.`
            }
          </p>
        </div>

        {/* Progress */}
        <div className="w-full max-w-[300px] flex flex-col gap-3">
          <div className="flex justify-between items-center px-1">
            <span className="text-xs font-bold text-primary tracking-wide uppercase">Processing</span>
            <span className="text-xs font-bold text-[#181310]/40 dark:text-white/40">{Math.min(100, Math.round(progress))}%</span>
          </div>
          <div className="h-3 w-full bg-[#e7dfda] dark:bg-[#3a261c] rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-100 ease-linear"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Cancel Button */}
      <div className="flex px-4 py-8 justify-center w-full bg-background-light dark:bg-background-dark">
        <button
          onClick={onCancel}
          className="flex min-w-[120px] max-w-[480px] cursor-pointer items-center justify-center overflow-hidden rounded-full h-12 px-6 bg-[#e7dfda] dark:bg-[#3a261c] hover:bg-[#dcd3ce] dark:hover:bg-[#4a3225] text-[#181310] dark:text-white text-sm font-bold leading-normal tracking-[0.015em] transition-colors gap-2"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
          <span className="truncate">Cancel Scan</span>
        </button>
      </div>

      <style>{`
          @keyframes scan {
              0% { top: 10%; opacity: 0; }
              50% { opacity: 1; }
              100% { top: 90%; opacity: 0; }
          }
        `}</style>
    </div>
  );
};
