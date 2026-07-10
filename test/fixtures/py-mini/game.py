class Game:
    def __init__(self):
        self.turn = 0

    def move(self, src, dst):
        # advance turn
        self.turn += 1
        return (src, dst)


def new_game():
    return Game()
