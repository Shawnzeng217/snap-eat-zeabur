
import { createClient } from '@supabase/supabase-js';

// Access environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log("Supabase Debug - URL:", supabaseUrl);
console.log("Supabase Debug - Key exists:", !!supabaseAnonKey);

// Safe Client Creation
const createSafeClient = () => {
    if (supabaseUrl && supabaseAnonKey) {
        return createClient(supabaseUrl, supabaseAnonKey);
    }

    console.error("Supabase environment variables (VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY) are MISSING. Returning safe mock client.");

    // Return a Mock Client that mimics the needed interface but warns developer
    return {
        from: (table: string) => ({
            select: () => {
                console.error(`Supabase MISSING: Attempted to select from ${table}`);
                return Promise.resolve({ data: [], error: { message: "Supabase configuration missing" } });
            },
            insert: (data: any) => {
                console.error(`Supabase MISSING: Attempted to insert into ${table}`);
                return Promise.resolve({ data: null, error: { message: "Supabase configuration missing" } });
            },
            update: () => ({
                eq: () => {
                    console.error(`Supabase MISSING: Attempted to update ${table}`);
                    return Promise.resolve({ data: null, error: { message: "Supabase configuration missing" } });
                }
            }),
            delete: () => ({
                eq: () => {
                    console.error(`Supabase MISSING: Attempted to delete from ${table}`);
                    return Promise.resolve({ data: null, error: { message: "Supabase configuration missing" } });
                }
            }),
        }),
        auth: {
            signInWithPassword: () => {
                console.error("Supabase MISSING: Attempted to sign in");
                return Promise.reject("Supabase configuration missing");
            },
            signUp: () => {
                console.error("Supabase MISSING: Attempted to sign up");
                return Promise.reject("Supabase configuration missing");
            },
            getSession: () => Promise.resolve({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => { } } } }),
            signOut: () => Promise.resolve({ error: null }),
        }
    } as any;
};

export const supabase = createSafeClient();

