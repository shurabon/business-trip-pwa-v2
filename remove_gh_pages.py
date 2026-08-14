import sys

with open('app.js', 'r') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.startswith("function saveGithubPagesToken() {"):
        start_idx = i
    if start_idx != -1 and line.startswith("function closePhotoModal() {"):
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_lines = lines[:start_idx] + lines[end_idx:]
    with open('app.js', 'w') as f:
        f.writelines(new_lines)
    print(f"Removed lines {start_idx} to {end_idx - 1}")
else:
    print("Could not find functions to remove")

