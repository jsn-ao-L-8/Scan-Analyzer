declare module "fft.js" {
  export default class FFT {
    constructor(size: number);
    readonly size: number;
    createComplexArray(): number[];
    transform(output: number[], input: number[]): void;
    inverseTransform(output: number[], input: number[]): void;
  }
}
