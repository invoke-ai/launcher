/// <reference types="vite/client" />

// electron-vite resolves `?asset` imports in the main process to the runtime file path.
declare module '*?asset' {
  const src: string;
  export default src;
}
