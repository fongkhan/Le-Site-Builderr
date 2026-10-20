// Message d'erreur d'un champ de formulaire, relié au champ par aria-describedby
// (invalidProps). Rien n'est rendu sans message.
export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return <span id={id} className="field-error">{message}</span>;
}
