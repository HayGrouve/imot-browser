import { Dialog, DialogContent } from '#/components/ui/dialog'
import { useApp } from './app-context'
import { DIALOG, DialogHead } from './import-dialog'

export function AboutDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useApp()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-labelledby="aboutTitle"
        className={`${DIALOG} w-[min(700px,calc(100vw-32px))]`}
      >
        <DialogHead
          id="aboutTitle"
          title={t('aboutTitle')}
          onClose={() => onOpenChange(false)}
        />
        <div
          tabIndex={0}
          className="flex-1 overflow-auto overscroll-contain px-8 pt-7 pb-9 outline-none max-[560px]:px-5 max-[560px]:pt-5 max-[560px]:pb-[max(28px,env(safe-area-inset-bottom))]"
        >
          {/* Static, trusted strings from src/lib/i18n.ts. */}
          <div
            className="mx-auto max-w-[68ch] text-[15px] leading-[1.65] text-foreground-2 max-[560px]:text-[14.5px] [&_.credits]:mt-8 [&_.credits]:border-t [&_.credits]:pt-4 [&_.credits]:text-[12.5px] [&_.credits]:leading-[1.55] [&_.credits]:text-muted-foreground [&_.lead]:text-base [&_.lead]:leading-[1.6] [&_.lead]:text-foreground [&_code]:rounded-md [&_code]:bg-foreground/7 [&_code]:px-[.32em] [&_code]:py-[.12em] [&_code]:font-mono [&_code]:text-[.84em] [&_code]:[overflow-wrap:anywhere] [&_code]:text-foreground [&_h3]:mt-8 [&_h3]:mb-2.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground [&_li]:mb-3 [&_li]:pl-1 [&_li::marker]:text-muted-foreground [&_p]:mt-0 [&_p]:mb-3.5 [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:m-0 [&_ul]:list-disc [&_ul]:pl-5"
            dangerouslySetInnerHTML={{ __html: t('aboutHtml') }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
