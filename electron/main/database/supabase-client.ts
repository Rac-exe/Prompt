import { createClient, SupabaseClient } from '@supabase/supabase-js';

export class SupabaseClientManager {
  private static instance: SupabaseClient | null = null;
  private static supabaseUrl: string = '';
  private static supabaseKey: string = '';

  static initialize(url: string, key: string) {
    this.supabaseUrl = url;
    this.supabaseKey = key;
    this.instance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  static getClient(): SupabaseClient {
    if (!this.instance) {
      throw new Error('Supabase client not initialized. Call initialize() first.');
    }
    return this.instance;
  }

  static isInitialized(): boolean {
    return this.instance !== null;
  }
}
