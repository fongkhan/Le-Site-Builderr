import type { BlockEditorProps } from '../types';
import { blockList, setField } from '../blockFields';
import { NEW_ITEMS, NEW_PLAN_FEATURE } from '../definitions';
import { ItemListEditor } from '../ItemListEditor';
import { TextField } from '../fields/TextField';

export function PricingEditor({ block, update }: BlockEditorProps) {
  return (
    <>
      <TextField label="Titre du bloc" value={block.title} onChange={(v) => setField(update, 'title', v)} />
      <ItemListEditor
        items={block.plans}
        onUpdate={blockList(update, 'plans')}
        newItem={NEW_ITEMS.pricing}
        itemLabel="Formule"
        addLabel="Ajouter une formule"
        renderItem={(plan, { update: updatePlan }) => (
          <>
            <TextField compact label="Nom de la formule" value={plan.name} onChange={(v) => updatePlan((d) => { d.name = v; })} />
            <TextField compact label="Prix" value={plan.price} onChange={(v) => updatePlan((d) => { d.price = v; })} />
            <TextField compact label="Description" value={plan.description} onChange={(v) => updatePlan((d) => { d.description = v; })} />
            {/* Une caractéristique par champ : les virgules sont permises dans le texte */}
            <ItemListEditor
              title="Caractéristiques"
              variant="inline"
              items={plan.features}
              onUpdate={(recipe, options) => updatePlan((d) => {
                d.features ??= [];
                recipe(d.features);
              }, options)}
              newItem={NEW_PLAN_FEATURE}
              itemLabel="Caractéristique"
              addLabel="Ajouter une caractéristique"
              renderItem={(feature, { update: updateFeature, index }) => (
                <TextField compact label={`Caractéristique ${index + 1}`} value={feature.feature} onChange={(v) => updateFeature((d) => { d.feature = v; })} />
              )}
            />
            <TextField compact label="Texte du bouton" value={plan.ctaText} onChange={(v) => updatePlan((d) => { d.ctaText = v; })} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4, fontSize: '0.75rem', color: 'white', cursor: 'pointer' }}>
              <input type="checkbox" checked={plan.isPopular || false} onChange={(e) => updatePlan((d) => { d.isPopular = e.target.checked; })} />
              Formule mise en avant (« Populaire »)
            </label>
          </>
        )}
      />
    </>
  );
}
