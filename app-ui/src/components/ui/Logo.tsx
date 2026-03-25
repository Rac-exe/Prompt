import darkLogo from "@/assets/logos/dark-logo-svg.svg";
import lightLogo from "@/assets/logos/light-logo-svg.svg";
import { useIsDark } from "@/hooks/useIsDark";

interface LogoProps {
  size?: string;
  className?: string;
}

export function Logo({ size = "w-8 h-8", className = "" }: LogoProps) {
  const isDark = useIsDark();
  return (
    <img
      src={isDark ? lightLogo : darkLogo}
      alt="Prmpt"
      className={`${size} object-contain flex-shrink-0 ${className}`.trim()}
    />
  );
}
