declare module 'munkres-js' {
  type Pair = [number, number];
  function computeMunkres(costMatrix: number[][], options?: { padValue?: number }): Pair[];
  export = computeMunkres;
}
