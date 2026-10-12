import { useState } from 'react'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { useApp } from './app-context'
import { DIALOG, DialogHead } from './searches-dialog'
import { workspaceLink } from '#/lib/workspace'

/** The link that opens this browser's listings on another device (there is no sign-in yet). */
export function ShareDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t, workspace } = useApp()
  const [copied, setCopied] = useState(false)
  const link = workspaceLink(workspace)
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setCopied(false)
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-labelledby="shareTitle"
        className={`${DIALOG} w-[min(560px,calc(100vw-32px))] max-[720px]:h-auto`}
      >
        <DialogHead
          id="shareTitle"
          title={t('shareTitle')}
          onClose={() => onOpenChange(false)}
        />
        <div className="flex flex-col gap-4 p-6 max-[560px]:px-4 max-[560px]:pt-4">
          <p className="m-0 text-foreground-2">{t('shareBody')}</p>
          <div className="flex gap-2 max-[560px]:flex-col">
            <Input
              readOnly
              value={link}
              aria-label={t('shareData')}
              onFocus={(e) => e.currentTarget.select()}
              className="font-mono text-[13px]"
            />
            <Button
              onClick={() => {
                void navigator.clipboard
                  .writeText(link)
                  .then(() => setCopied(true))
              }}
            >
              {copied ? (
                <CheckIcon aria-hidden="true" />
              ) : (
                <CopyIcon aria-hidden="true" />
              )}
              {copied ? t('copied') : t('copyLink')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
