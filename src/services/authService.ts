
/**
 * Service to handle Google Identity Services (GIS) authentication
 */

const CLIENT_ID = process.env.VITE_GOOGLE_CLIENT_ID;
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets';

let tokenClient: google.accounts.oauth2.TokenClient | null = null;

export const authService = {
  /**
   * Load the GIS script if not already loaded
   */
  loadGisScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = (err) => reject(new Error('Failed to load Google Identity Services script'));
      document.head.appendChild(script);
    });
  },

  /**
   * Initialize the token client
   */
  initTokenClient(callback: (response: google.accounts.oauth2.TokenResponse) => void): void {
    if (!CLIENT_ID) {
      console.error('VITE_GOOGLE_CLIENT_ID is not defined in environment variables');
      return;
    }

    if (tokenClient) return;

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('GIS Auth Error:', response.error, response.error_description);
        }
        callback(response);
      },
      error_callback: (err) => {
        console.error('GIS Initialization Error:', err.message);
      }
    });
  },

  /**
   * Request a new access token
   */
  requestAccessToken(prompt: 'none' | 'consent' | 'select_account' = 'none'): void {
    if (!tokenClient) {
      console.error('Token client not initialized');
      return;
    }

    tokenClient.requestAccessToken({ prompt });
  },

  /**
   * Revoke the access token
   */
  revokeToken(accessToken: string): void {
    google.accounts.oauth2.revoke(accessToken, () => {
      console.log('Token revoked');
    });
  }
};
