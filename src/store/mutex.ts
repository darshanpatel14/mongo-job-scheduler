export class Mutex {
  private locked = false;
  private waiting: Array<() => void> = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this.waiting.shift();
        if (next) next();
        else this.locked = false;
      };

      if (!this.locked) {
        this.locked = true;
        resolve(release);
      } else {
        this.waiting.push(() => resolve(release));
      }
    });
  }
}
