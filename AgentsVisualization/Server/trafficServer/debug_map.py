#!/usr/bin/env python3
"""Debug script to verify map reading."""

# Read the map file
with open('city_files/2025_base.txt') as f:
    lines = f.readlines()

width = len(lines[0]) - 1
height = len(lines)

print(f"Map dimensions: {width}x{height}")
print()

# Check specific positions
test_positions = [
    (4, 2, "Should be ^ (road)"),
    (2, 2, "Should be # (obstacle)"),
    (0, 2, "Should be v (road)"),
]

for x, z, expected in test_positions:
    # Convert z to row (server uses: height - r - 1 = z, so r = height - z - 1)
    r = height - z - 1
    c = x

    if 0 <= r < len(lines) and 0 <= c < len(lines[r]):
        char = lines[r][c]
        print(f"Position x={x}, z={z} (file row={r}, col={c}): '{char}' - {expected}")
    else:
        print(f"Position x={x}, z={z}: OUT OF BOUNDS")

print()
print("First 10 rows of map:")
for i in range(min(10, len(lines))):
    print(f"Row {i}: {lines[i].rstrip()}")
