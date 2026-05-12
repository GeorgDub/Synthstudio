/**
 * A simple seedable pseudo-random number generator (PRNG).
 * This is a basic implementation of the Lehmer random number generator.
 */
export class PRNG {
  /**
   * @param {number} seed
   */
  constructor(seed) {
    this.seed = seed;
  }

  /**
   * Returns a pseudo-random number between 0 (inclusive) and 1 (exclusive).
   * @returns {number}
   */
  next() {
    this.seed = (this.seed * 48271) % 2147483647;
    return this.seed / 2147483647;
  }

  /**
   * Returns a pseudo-random integer between min (inclusive) and max (exclusive).
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  nextInt(min, max) {
    return Math.floor(this.next() * (max - min)) + min;
  }

  /**
   * Returns true with a given probability.
   * @param {number} probability - A value between 0 and 1.
   * @returns {boolean}
   */
  chance(probability) {
    return this.next() < probability;
  }
}
