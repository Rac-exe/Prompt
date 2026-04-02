import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ElectronStorageAdapter } from './electron-storage-adapter';

export class SupabaseClientManager {
  private static instance: SupabaseClient | null = null;
  private static adminInstance: SupabaseClient | null = null;
  private static supabaseUrl: string = '';
  private static supabaseKey: string = '';
  private static storageAdapter: ElectronStorageAdapter | null = null;

  static initialize(url: string, key: string) {
    this.supabaseUrl = url;
    this.supabaseKey = key;
    
    // Create custom storage adapter for Electron main process
    this.storageAdapter = new ElectronStorageAdapter();
    
    console.log('[SupabaseClientManager] Initializing with custom storage adapter');
    
    this.instance = createClient(url, key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storage: this.storageAdapter as any, // Custom storage for Electron
        flowType: 'pkce', // PKCE sends ?code= query param; implicit flow uses #hash (unusable by HTTP server)
      },
    });
    
    console.log('[SupabaseClientManager] ✅ Supabase client initialized');
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

  /**
   * Admin client using the service role key — bypasses RLS.
   * Used only for admin operations like resetting a user's password.
   */
  static getAdminClient(): SupabaseClient | null {
    if (this.adminInstance) return this.adminInstance;

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey || serviceRoleKey === 'your-service-role-key') {
      console.warn('[SupabaseClientManager] SUPABASE_SERVICE_ROLE_KEY not set — admin operations unavailable');
      return null;
    }

    this.adminInstance = createClient(this.supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('[SupabaseClientManager] Admin client initialized');
    return this.adminInstance;
  }

  /**
   * Diagnostic: Check if session is valid
   */
  static async verifySession(): Promise<{ hasSession: boolean; userId: string | null }> {
    if (!this.instance) {
      return { hasSession: false, userId: null };
    }

    try {
      const { data, error } = await this.instance.auth.getSession();
      
      if (error) {
        console.error('[SupabaseClientManager] Session error:', error);
        return { hasSession: false, userId: null };
      }

      const hasSession = !!data.session;
      const userId = data.session?.user?.id || null;

      console.log('[SupabaseClientManager] Session check:', { hasSession, userId });
      
      return { hasSession, userId };
    } catch (error) {
      console.error('[SupabaseClientManager] Session verification failed:', error);
      return { hasSession: false, userId: null };
    }
  }
}
