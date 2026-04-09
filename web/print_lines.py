import sys
from pathlib import Path
if len(sys.argv) < 3:
    print('Usage: print_lines.py <path> <max_lines>')
    sys.exit(1)
path = Path(sys.argv[1])
max_lines = int(sys.argv[2])
with path.open(encoding='utf-8') as f:
    for i, line in enumerate(f, 1):
        if i > max_lines:
            break
        print(f"{i}: {line.rstrip()}" )
