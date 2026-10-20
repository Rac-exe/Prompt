import { ipcMain } from 'electron';
import { UserService } from '../database/services/user-service';
import { ChatService } from '../database/services/chat-service';
import { PromptLibraryService } from '../database/services/prompt-library-service';
import { AppWindowManager } from '../windows/app-window-manager';

/**
 * Local session bootstrap.
 *
 * There is no login: the app always runs as the local user. The renderer
 * still listens for the same events it used for sign-in (auth:state-changed,
 * chats-loaded, prompt-library:loaded), so this module sends those once the
 * local data is read.
 */

const userService = new UserService();
const chatService = new ChatService();
const promptLibraryService = new PromptLibraryService();

async function localUserPayload() {
    const userData = await userService.getCompleteUserData();
    return { isAuthenticated: true, user: { ...userData, identities: [] } };
}

/**
 * Send the local user, chats and prompt library to the renderer.
 */
export async function startLocalSession(appWindowManager: AppWindowManager): Promise<void> {
    try {
        appWindowManager.send('auth:state-changed', await localUserPayload());

        const [chats, library] = await Promise.all([
            chatService.getChats(),
            promptLibraryService.getFullLibrary(),
        ]);
        appWindowManager.send('chats-loaded', { chats });
        appWindowManager.send('prompt-library:loaded', library);
        console.log(`[Session] Local data loaded: ${chats.length} chats, ${library.prompts.length} prompts`);
    } catch (error) {
        console.error('[Session] Failed to load local data:', error);
        appWindowManager.send('auth:state-changed', {
            isAuthenticated: false,
            user: null,
            error: 'Could not open the local database',
        });
    }
}

/**
 * Register session IPC handlers
 */
export function registerSessionHandlers(appWindowManager: AppWindowManager) {
    // The renderer asks for the session state when it mounts.
    ipcMain.on('auth:check', () => {
        void startLocalSession(appWindowManager);
    });
}
