declare module '../modules/user/user.model' {
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
