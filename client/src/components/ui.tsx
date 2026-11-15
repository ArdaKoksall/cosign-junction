import { Button as HeroButton, Card as HeroCard, Chip } from "@heroui/react";
import type { ReactNode } from "react";

export function Button({
  onClick,
  disabled,
  children,
  className = "",
  type = "button",
  variant = "primary",
  size = "sm",
  isIconOnly = false,
  ariaLabel,
}: {
  onClick?: () => void;
  disabled?: boolean;
  children?: ReactNode;
  className?: string;
  type?: "button" | "submit" | "reset";
  variant?:
    | "primary"
    | "secondary"
    | "tertiary"
    | "ghost"
    | "danger"
    | "danger-soft";
  size?: "sm" | "md" | "lg";
  isIconOnly?: boolean;
  ariaLabel?: string;
}) {
  return (
    <HeroButton
      aria-label={ariaLabel}
      className={className}
      isDisabled={disabled}
      isIconOnly={isIconOnly}
      size={size}
      type={type}
      variant={variant}
      onPress={onClick}
    >
      {children}
    </HeroButton>
  );
}

export function Badge({
  children,
  className = "",
  color = "default",
  variant = "soft",
}: {
  children: ReactNode;
  className?: string;
  color?: "default" | "accent" | "success" | "warning" | "danger";
  variant?: "primary" | "secondary" | "tertiary" | "soft";
}) {
  return (
    <Chip className={className} color={color} size="sm" variant={variant}>
      {children}
    </Chip>
  );
}

export function Card({
  children,
  className = "",
  variant = "default",
}: {
  children: ReactNode;
  className?: string;
  variant?: "default" | "secondary" | "tertiary" | "transparent";
}) {
  return (
    <HeroCard className={className} variant={variant}>
      {children}
    </HeroCard>
  );
}
