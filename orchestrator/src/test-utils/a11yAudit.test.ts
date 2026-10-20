import { describe, expect, it } from 'vitest';
import { auditForm, auditFormControls } from './a11yAudit';

describe('auditFormControls', () => {
  it.each([
    ['label for relié', '<label for="a">Nom</label><input id="a" type="text"/>'],
    ['champ imbriqué dans le label', '<label><input type="checkbox"/> Accepter</label>'],
    ['aria-label', '<select aria-label="Langue"><option>fr</option></select>'],
    ['aria-labelledby valide', '<span id="t">Titre</span><textarea aria-labelledby="t"></textarea>'],
    ['description reliée', '<label for="a">Nom</label><input id="a" aria-describedby="e"/><span id="e">Requis</span>'],
  ])('conforme : %s', (_cas, html) => {
    expect(auditFormControls(html)).toEqual([]);
  });

  it.each([
    ['input sans nom', '<input type="text"/>', /sans nom accessible/],
    ['placeholder seul', '<input type="number" placeholder="ex : 10"/>', /sans nom accessible/],
    ['aria-label vide', '<input aria-label=" "/>', /sans nom accessible/],
    ['label orphelin', '<label class="field-label">Nom</label><input id="x" aria-label="Nom"/>', /orphelin/],
    ['for vers un id absent', '<label for="absent">Nom</label><input id="a"/>', /for vers un id absent/],
    ['aria-describedby vers un id absent', '<input aria-label="Nom" aria-describedby="absent"/>', /aria-describedby vers un id absent/],
    ['aria-labelledby vers un id absent', '<input aria-labelledby="absent"/>', /aria-labelledby vers un id absent/],
  ])('signalé : %s', (_cas, html, message) => {
    const problems = auditFormControls(html);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join('\n')).toMatch(message);
  });

  it('ignorés : input hidden et input file masqué (display:none)', () => {
    expect(auditFormControls('<input type="hidden" name="x"/><input type="file" style="display:none"/>')).toEqual([]);
    // Un champ fichier visible doit être nommé
    expect(auditFormControls('<input type="file" style="opacity:0"/>')).toHaveLength(1);
  });
});

describe('auditForm', () => {
  const ok = '<form novalidate=""><button type="button">Annuler</button><button type="submit">OK</button></form>';

  it('formulaire conforme', () => {
    expect(auditForm(ok)).toEqual([]);
  });

  it('signale 0 ou 2 formulaires', () => {
    expect(auditForm('<div><button type="submit">OK</button></div>').join()).toMatch(/0 <form>/);
    expect(auditForm(ok + ok).join()).toMatch(/2 <form>/);
  });

  it('signale l’absence de novalidate', () => {
    expect(auditForm('<form><button type="submit">OK</button></form>')).toEqual(['<form> sans novalidate']);
  });

  it('signale 0 ou 2 boutons de soumission', () => {
    expect(auditForm('<form novalidate=""><button type="button">A</button></form>').join()).toMatch(/0 bouton/);
    expect(auditForm('<form novalidate=""><button type="submit">A</button><input type="submit" value="B"/></form>').join()).toMatch(/2 bouton/);
  });

  it('signale un bouton sans type', () => {
    expect(auditForm('<form novalidate=""><button>Fermer</button><button type="submit">OK</button></form>')).toEqual(['<button> sans type']);
  });
});
