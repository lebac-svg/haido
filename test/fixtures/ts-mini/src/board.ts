// Board of the game
export class Board {
  private cells: number[] = [];

  move(from: number, to: number): boolean {
    // move a piece
    if (from === to) return false;
    this.cells[to] = this.cells[from] ?? 0;
    return true;
  }

  undo(): void {
    this.cells.pop();
  }
}
