import { useNavigate } from 'react-router-dom'
import { Placeholder } from '@/components/Placeholder'
import { Button } from '@/components/ui/Button'
import { useSession } from '@/lib/store'

export default function Onboarding() {
  const navigate = useNavigate()
  const userId = useSession((s) => s.userId)
  const complete = useSession((s) => s.completeOnboarding)

  return (
    <div className="mx-auto max-w-2xl px-4 py-10">
      <Placeholder
        title="Onboarding wizard"
        note="The full 3-step wizard (basics → preferences → CV) will be built in a later step."
      />
      <Button
        className="mt-6"
        onClick={() => {
          if (userId) complete(userId)
          navigate('/app')
        }}
      >
        Skip for now → Enter app
      </Button>
    </div>
  )
}
