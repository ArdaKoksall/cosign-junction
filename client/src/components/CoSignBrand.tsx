import "./cosign-brand.css";

export function CoSignMark({ className }: { className?: string }) {
  return (
    <img
      src="/cosign-signature.png"
      className={className ? `cosign-mark ${className}` : "cosign-mark"}
      width={96}
      height={96}
      alt=""
    />
  );
}

export function CoSignBrand({ inverse = false }: { inverse?: boolean }) {
  return (
    <span className="cosign-brand" data-inverse={inverse || undefined}>
      <CoSignMark />
      <CosignWordmark />
    </span>
  );
}

export function CosignWordmark() {
  return (
    <span className="cosign-wordmark">
      <span className="cosign-prefix">VALIO:</span><CosignName />
    </span>
  );
}

export function CosignName() {
  return <span className="cosign-script">Cosign</span>;
}
