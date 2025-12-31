import * as DialogPrimitive from '@radix-ui/react-dialog';
import { FileText, Shield, X } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../components/lib/utils';
import { Button } from '../../components/ui/button';
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from '../../components/ui/dialog';
import { ScrollArea } from '../../components/ui/scroll-area';
import { terms as jaTerms } from '../constants/terms/ja';
import { useI18n } from '../i18n/store';

/**
 * Markdownコンテンツ用のカスタムコンポーネント定義
 * Tailwindスタイリングを適用してリッチな表示を実現
 */
const markdownComponents = {
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-base font-bold text-foreground mt-6 mb-3 pb-2 border-b border-border">
      {children}
    </h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-sm font-semibold text-foreground/90 mt-4 mb-2">
      {children}
    </h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-sm leading-relaxed text-muted-foreground mb-3">
      {children}
    </p>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc list-inside text-sm text-muted-foreground mb-3 space-y-1 ml-2">
      {children}
    </ul>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="leading-relaxed">{children}</li>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
};

/**
 * 規約表示用ダイアログの本体コンポーネント。
 * 閉じるボタンの表示を制御できる。
 */
const DialogContent = ({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      className={cn(
        'fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
);

interface TermsModalProps {
  open: boolean;
  onAccept: () => void;
  isUpdate?: boolean;
  canClose?: boolean;
}

/**
 * 利用規約とプライバシーポリシーを提示するモーダル。
 * アプリ初回起動時や更新時に表示される。
 * Markdownコンテンツをリッチにレンダリングする。
 */
export const TermsModal = ({
  open,
  onAccept,
  isUpdate = false,
  canClose = true,
}: TermsModalProps) => {
  const { t } = useI18n();
  const [_accepted, setAccepted] = useState(false);

  const terms = jaTerms;

  /**
   * 利用規約への同意を記録し、親コンポーネントへ通知する。
   * TermsModal 内部でのみ使用されるクリックハンドラ。
   */
  const handleAccept = () => {
    setAccepted(true);
    onAccept();
  };

  return (
    <Dialog open={open} onOpenChange={canClose ? () => {} : undefined}>
      <DialogContent
        className="max-w-[800px] h-[80vh] bg-popover/95 backdrop-blur-md border border-border/50 shadow-2xl"
        showCloseButton={canClose}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-foreground">
            {isUpdate ? t('terms.updateTitle') : t('terms.title')}
          </DialogTitle>
          <DialogDescription className="sr-only">
            {t('terms.title')}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-full pr-4">
          <div className="space-y-8">
            <section>
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <FileText className="h-5 w-5" />
                {terms.sections.termsOfService.title}
              </h3>
              <div className="bg-muted/80 rounded-lg p-6 backdrop-blur-sm border border-border/50">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {terms.sections.termsOfService.content}
                </Markdown>
              </div>
            </section>

            <section>
              <h3 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5" />
                {terms.sections.privacyPolicy.title}
              </h3>
              <div className="bg-muted/80 rounded-lg p-6 backdrop-blur-sm border border-border/50">
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {terms.sections.privacyPolicy.content}
                </Markdown>
              </div>
            </section>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button onClick={handleAccept}>{t('terms.accept')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
