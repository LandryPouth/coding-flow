import sys


def parse(argv):
    if not argv:
        return None
    if argv[0] == "-h":
        return "help"
    return argv[0]


class Runner:
    def run(self, name):
        if name is None:
            return 1
        print(name)
        return 0


def main():
    return Runner().run(parse(sys.argv[1:]))
