import { cn } from '@/lib/utils'

type EmptyStateProps = {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  className?: string
  size?: 'sm' | 'default' | 'lg'
}

/**
 * Empty state genérico para mostrar cuando una lista/sección no tiene contenido.
 *
 * @example
 * <EmptyState
 *   icon={<Package className="size-12" />}
 *   title="No hay productos cargados"
 *   description="Empezá creando el primer producto del catálogo"
 *   action={<Button>Crear producto</Button>}
 * />
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  size = 'default',
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-lg border border-dashed',
        size === 'sm' && 'p-6 gap-2',
        size === 'default' && 'p-10 gap-3',
        size === 'lg' && 'p-16 gap-4',
        className
      )}
    >
      {icon && (
        <div
          className={cn(
            'text-muted-foreground/30',
            size === 'sm' && '[&>svg]:size-8',
            size === 'default' && '[&>svg]:size-12',
            size === 'lg' && '[&>svg]:size-14'
          )}
        >
          {icon}
        </div>
      )}

      <div className="space-y-1 max-w-sm">
        <h3
          className={cn(
            'font-medium text-foreground',
            size === 'sm' ? 'text-sm' : 'text-base'
          )}
        >
          {title}
        </h3>
        {description && (
          <p
            className={cn(
              'text-muted-foreground',
              size === 'sm' ? 'text-xs' : 'text-sm'
            )}
          >
            {description}
          </p>
        )}
      </div>

      {(action || secondaryAction) && (
        <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  )
}