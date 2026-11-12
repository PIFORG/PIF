from pathlib import Path

# Fix pricing-studio scenarios description binding
p = Path("apps/web/src/app/actuarial/pricing-studio.page.ts")
t = p.read_text(encoding="utf-8")
t = t.replace(
    '''[description]="'Hypothèses et résultats calculés côté serveur, privés. Jusqu\\\\'à ' + limit() + '.'"''',
    '[description]="scenariosDescription()"',
)
# If still old form with single backslash
t = t.replace(
    '''[description]="'Hypothèses et résultats calculés côté serveur, privés. Jusqu\\'à ' + limit() + '.'"''',
    '[description]="scenariosDescription()"',
)
# Also match whatever is currently there via regex
import re
t2, n = re.subn(
    r'\[description\]="[^"]*limit\(\)[^"]*"',
    '[description]="scenariosDescription()"',
    t,
    count=1,
)
print("pricing desc replacements", n)
# Add method to ScenariosPanel class if missing
if "scenariosDescription" not in t2:
    t2 = t2.replace(
        "export class ScenariosPanel",
        '''export class ScenariosPanelPlaceholder'''
    )
# Find class for scenarios panel
m = re.search(r"export class (\w+).*?limit\s*=\s*input", t2, re.S)
print("nearby", "limit = input" in t2)
# Insert method before first protected/readonly after class Scenarios - read structure
if "scenariosDescription()" not in t2.split("template:")[0] and 'scenariosDescription(): string' not in t2:
    # add after export class line for the panel that has limit input
    pass
p.write_text(t2, encoding="utf-8")
print("written pricing")