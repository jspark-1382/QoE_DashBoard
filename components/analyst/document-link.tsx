import type { AnchorHTMLAttributes } from 'react';

type DocumentLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

/** Apply the same /qoe base path to React links and Leaflet popup anchors. */
export function withQoeBasePath(href: string): string {
  return href.startsWith('/') &&
    !href.startsWith('//') &&
    !/^\/qoe(?:[/?#]|$)/.test(href)
      ? '/qoe' + href
      : href;
}

export default function DocumentLink({ href, ...props }: DocumentLinkProps) {
  return <a {...props} href={withQoeBasePath(href)} />;
}
