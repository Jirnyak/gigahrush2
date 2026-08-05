import os

extra = """
#### Фаза 8: Логирование и Метрики
- Убедитесь, что все критические изменения производительности имеют соответствующие метрики.
- При необходимости используйте `console.time()` и `console.timeEnd()` во время разработки, но удалите их перед финальным коммитом, оставив только агрегированную статистику.
"""

for i in range(70, 80):
    filename = f"marx_{i}.md"
    if not os.path.exists(filename):
        continue
    
    with open(filename, 'r', encoding='utf-8') as f:
        content = f.read()
        
    if '#### Фаза 8:' not in content:
        content += "\n" + extra
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(content)
        
    print(f"Updated {filename} (new length: {len(content.splitlines())} lines)")

