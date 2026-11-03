import type { AnchorHTMLAttributes } from 'react';

type DocumentLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
};

export default function DocumentLink({ href, ...props }: DocumentLinkProps) {
  const documentHref =
    href.startsWith('/') &&
    !href.startsWith('//') &&
    !/^\/qoe(?:[/?#]|$)/.test(href)
      ? '/qoe' + href
      : href;

  return <a {...props} href={documentHref} />;
}
