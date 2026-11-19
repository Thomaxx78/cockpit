/* Logo Sapaudia : deux sommets (la Savoie) et le soleil, en aplat.
   Dessiné à la main sur une grille 32×32, sans dégradé ni étoile. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <circle cx="23" cy="9" r="3.4" fill="#ffc94d" />
      <path d="M3 25 L12.5 9.5 L18 18.5 L21 14 L29 25 Z" fill="currentColor" />
      {/* versant à l'ombre du grand sommet */}
      <path d="M12.5 9.5 L18 18.5 L16.4 25 L13.8 25 Z" fill="#000" opacity=".16" />
    </svg>
  );
}
