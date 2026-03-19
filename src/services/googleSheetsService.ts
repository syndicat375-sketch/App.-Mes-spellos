import { Shift, Assignment, RelayType, UserProfile } from '../types';

const SPREADSHEET_NAME = 'Relais de travail';
const SHIFTS_SHEET = 'Relais';
const SETTINGS_SHEET = 'Parametres';

export interface GoogleSheetsService {
  getSpreadsheetId(accessToken: string): Promise<string | null>;
  createSpreadsheet(accessToken: string): Promise<string>;
  getShifts(accessToken: string, spreadsheetId: string): Promise<Shift[]>;
  saveShift(accessToken: string, spreadsheetId: string, shift: Omit<Shift, 'id'>): Promise<void>;
  deleteShift(accessToken: string, spreadsheetId: string, date: string): Promise<void>;
  getProfile(accessToken: string, spreadsheetId: string): Promise<UserProfile | null>;
  saveProfile(accessToken: string, spreadsheetId: string, profile: Omit<UserProfile, 'uid' | 'syncStatus'>): Promise<void>;
}

export const googleSheetsService: GoogleSheetsService = {
  async getSpreadsheetId(accessToken: string): Promise<string | null> {
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json();
      const error = new Error(errorData.error?.message || 'Failed to fetch spreadsheet ID');
      (error as any).status = response.status;
      throw error;
    }

    const data = await response.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
    return null;
  },

  async createSpreadsheet(accessToken: string): Promise<string> {
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: {
          title: SPREADSHEET_NAME,
        },
        sheets: [
          { properties: { title: SHIFTS_SHEET } },
          { properties: { title: SETTINGS_SHEET } }
        ]
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const error = new Error(errorData.error?.message || 'Failed to create spreadsheet');
      (error as any).status = response.status;
      throw error;
    }

    const data = await response.json();
    const spreadsheetId = data.spreadsheetId;

    if (!spreadsheetId) {
      throw new Error('Spreadsheet ID not returned from Google API');
    }

    // Initialize headers for Shifts
    const shiftsHeaderResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHIFTS_SHEET}!A1:H1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [['date', 'employe_1', 'relais_1', 'employe_2', 'relais_2', 'employe_3', 'relais_3', 'note']],
        }),
      }
    );

    if (!shiftsHeaderResponse.ok) {
      console.warn('Failed to initialize shifts headers');
    }

    // Initialize headers for Settings
    const settingsHeaderResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SETTINGS_SHEET}!A1:B1?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [['displayName', 'email']],
        }),
      }
    );

    if (!settingsHeaderResponse.ok) {
      console.warn('Failed to initialize settings headers');
    }

    return spreadsheetId;
  },

  async getShifts(accessToken: string, spreadsheetId: string): Promise<Shift[]> {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHIFTS_SHEET}!A2:H`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      const error = new Error(errorData.error?.message || 'Failed to fetch shifts');
      (error as any).status = response.status;
      throw error;
    }

    const data = await response.json();
    if (!data.values) return [];

    return data.values.map((row: any[]) => {
      const assignments: Assignment[] = [];
      if (row[1] && row[2]) assignments.push({ employeeName: row[1], relayType: row[2] as RelayType });
      if (row[3] && row[4]) assignments.push({ employeeName: row[3], relayType: row[4] as RelayType });
      if (row[5] && row[6]) assignments.push({ employeeName: row[5], relayType: row[6] as RelayType });

      return {
        id: row[0],
        date: row[0],
        assignments,
        employeeNames: assignments.map(a => a.employeeName),
        configType: assignments.length === 3 ? '3-employees' : '2-employees',
        createdBy: 'google-sheets',
        note: row[7] || '',
      };
    });
  },

  async saveShift(accessToken: string, spreadsheetId: string, shift: Omit<Shift, 'id'>): Promise<void> {
    const shifts = await this.getShifts(accessToken, spreadsheetId);
    const existingIndex = shifts.findIndex((s) => s.date === shift.date);

    const row = [
      shift.date,
      shift.assignments[0]?.employeeName || '',
      shift.assignments[0]?.relayType || '',
      shift.assignments[1]?.employeeName || '',
      shift.assignments[1]?.relayType || '',
      shift.assignments[2]?.employeeName || '',
      shift.assignments[2]?.relayType || '',
      shift.note || '',
    ];

    let response;
    if (existingIndex !== -1) {
      const rowIndex = existingIndex + 2;
      response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHIFTS_SHEET}!A${rowIndex}:H${rowIndex}?valueInputOption=USER_ENTERED`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [row],
          }),
        }
      );
    } else {
      response = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SHIFTS_SHEET}!A1:append?valueInputOption=USER_ENTERED`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            values: [row],
          }),
        }
      );
    }

    if (!response.ok) {
      const errorData = await response.json();
      const error = new Error(errorData.error?.message || 'Failed to save shift');
      (error as any).status = response.status;
      throw error;
    }
  },

  async deleteShift(accessToken: string, spreadsheetId: string, date: string): Promise<void> {
    const shifts = await this.getShifts(accessToken, spreadsheetId);
    const existingIndex = shifts.findIndex((s) => s.date === date);

    if (existingIndex !== -1) {
      const rowIndex = existingIndex + 1;
      // Need to find the sheetId for SHIFTS_SHEET
      const ssResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });

      if (!ssResponse.ok) {
        throw new Error('Failed to fetch spreadsheet metadata for deletion');
      }

      const ssData = await ssResponse.json();
      const sheetId = ssData.sheets.find((s: any) => s.properties.title === SHIFTS_SHEET).properties.sheetId;

      const deleteResponse = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: [
            {
              deleteDimension: {
                range: {
                  sheetId: sheetId,
                  dimension: 'ROWS',
                  startIndex: rowIndex,
                  endIndex: rowIndex + 1,
                },
              },
            },
          ],
        }),
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json();
        throw new Error(errorData.error?.message || 'Failed to delete shift');
      }
    }
  },

  async getProfile(accessToken: string, spreadsheetId: string): Promise<UserProfile | null> {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SETTINGS_SHEET}!A2:C2`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) return null;
      const errorData = await response.json();
      const error = new Error(errorData.error?.message || 'Failed to fetch profile');
      (error as any).status = response.status;
      throw error;
    }

    const data = await response.json();
    if (!data.values || data.values.length === 0) return null;

    return {
      uid: 'google-sheets',
      displayName: data.values[0][0] || '',
      email: data.values[0][1] || '',
      employees: data.values[0][2] ? data.values[0][2].split(',').map((s: string) => s.trim()).filter(Boolean) : [],
    };
  },

  async saveProfile(accessToken: string, spreadsheetId: string, profile: Omit<UserProfile, 'uid' | 'syncStatus'>): Promise<void> {
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${SETTINGS_SHEET}!A2:C2?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: [[profile.displayName, profile.email, (profile.employees || []).join(', ')]],
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'Failed to save profile');
    }
  },
};
