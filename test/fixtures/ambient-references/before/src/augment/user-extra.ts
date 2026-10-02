declare module '../models/user.model' {
  interface User {
    nickname?: string;
  }
}

declare module '../config/settings' {
  interface Settings {
    theme?: string;
  }
}

export {};
