import cv from '@techstark/opencv-js';

export type OpenCv = typeof cv;

let loaded: Promise<OpenCv> | null = null;

export function loadOpenCv(): Promise<OpenCv> {
  if (!loaded) {
    loaded = Promise.resolve(cv);
  }
  return loaded;
}
