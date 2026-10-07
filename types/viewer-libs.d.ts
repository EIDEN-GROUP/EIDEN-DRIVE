declare module "mammoth/mammoth.browser" {
  const mammoth: { convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string; messages: unknown[] }>; extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }> };
  export default mammoth;
}
declare module "utif" {
  const UTIF: { decode(buf: ArrayBuffer): { width: number; height: number }[]; decodeImage(buf: ArrayBuffer, ifd: unknown): void; toRGBA8(ifd: unknown): Uint8Array };
  export default UTIF;
}
declare module "pdfjs-dist/build/pdf";
