import { useNavigate } from 'react-router-dom';
import { Button } from '../design-system/Button';
import { useServices } from '../app/services';
import { useAppStore } from '../app/stores';
import { homeDayModel } from '../../application/usecases/homeDayModel';
import { goalForecast } from '../../domain/apnea/goalEngine';
import { GoalCard } from '../components/GoalCard';
import { HomeHeroDock } from '../components/HomeHeroDock';
import { AppShell } from '../app/AppShell';
import { AdOpportunityProbe } from '../analytics/AdOpportunityProbe';

export function HomeScreen() {
  const navigate = useNavigate();
  const { clock } = useServices();
  const state = useAppStore((store) => store.state);
  const now = clock.now();
  const model = homeDayModel(state, now);
  const forecast = state.goal ? goalForecast(state, state.goal, now) : null;

  function launch() {
    navigate('/runner', {
      state: {
        plan: model.today.plan,
        difficultyLevel: model.today.appliedDifficulty,
        earlyContractionThresholds: model.today.earlyContractionThresholds,
      },
    });
  }

  return (
    <AppShell
      bottomAction={(
        <HomeHeroDock
          model={model}
          onLaunch={launch}
          onMeasureBaseline={() => navigate('/baseline')}
        />
      )}
    >
      <div className="flex flex-col gap-4">
        {forecast ? (
          <GoalCard
            forecast={forecast}
            onOpen={() => navigate('/stats', { state: { focus: 'goal' } })}
            onSetGoal={forecast.achieved ? () => navigate('/goal') : undefined}
          />
        ) : (
          <Button variant="ghost" onClick={() => navigate('/goal')}>
            Set a max-hold goal
          </Button>
        )}
        <AdOpportunityProbe placement="home_inline" surface="home" />
      </div>
    </AppShell>
  );
}
