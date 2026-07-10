import game
from helpers import clamp


def run():
    g = game.new_game()
    return clamp(g.turn, 0, 1)
