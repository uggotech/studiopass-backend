export interface TSticker {
  id: string;
  name: string;
  url: string;
  pack: "studiopass-core";
}

/** Built-in StudioPass sticker pack (static SVGs under /public/stickers). */
export const BUILTIN_STICKERS: TSticker[] = [
  { id: "heart", name: "Heart", url: "/stickers/heart.svg", pack: "studiopass-core" },
  { id: "fire", name: "Fire", url: "/stickers/fire.svg", pack: "studiopass-core" },
  { id: "mic", name: "Mic", url: "/stickers/mic.svg", pack: "studiopass-core" },
  { id: "radio", name: "Radio", url: "/stickers/radio.svg", pack: "studiopass-core" },
  { id: "clap", name: "Clap", url: "/stickers/clap.svg", pack: "studiopass-core" },
  { id: "laugh", name: "Laugh", url: "/stickers/laugh.svg", pack: "studiopass-core" },
  { id: "wow", name: "Wow", url: "/stickers/wow.svg", pack: "studiopass-core" },
  { id: "thumbsup", name: "Thumbs Up", url: "/stickers/thumbsup.svg", pack: "studiopass-core" },
  { id: "star", name: "Star", url: "/stickers/star.svg", pack: "studiopass-core" },
  { id: "music", name: "Music", url: "/stickers/music.svg", pack: "studiopass-core" },
  { id: "prayer", name: "Prayer", url: "/stickers/prayer.svg", pack: "studiopass-core" },
  { id: "hello", name: "Hello", url: "/stickers/hello.svg", pack: "studiopass-core" },
];

export const getStickerLibrary = () => ({
  pack: "studiopass-core",
  stickers: BUILTIN_STICKERS,
});
