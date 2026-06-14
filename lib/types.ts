export interface PhotoVariant {
  format: string;
  width: number;
  height: number;
  bytes: number;
  path: string;
}

export interface PhotoPlaceholder {
  type: "none" | "color" | "lqip";
  width?: number;
  height?: number;
  dataURI?: string;
  color?: string;
}

export interface Photo {
  id: string;
  source: {
    path: string;
    width: number;
    height: number;
    bytes: number;
    hash: string;
    format: string;
  };
  aspectRatio: number;
  placeholder: PhotoPlaceholder;
  variants: PhotoVariant[];
  srcset: Record<string, string>;
  fallback: string;
}

export interface ImgforgeManifest {
  version: number;
  profile: string;
  images: Photo[];
}
