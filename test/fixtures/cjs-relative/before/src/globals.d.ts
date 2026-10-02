declare const require: {
  (id: string): any;
  resolve(id: string): string;
  main: unknown;
};

declare const module: {
  exports: unknown;
  id: string;
};
