import { DeploymentStatus, canTransition, ALLOWED_STATE_TRANSITIONS } from '../src';

describe('Deployment State Machine', () => {
  it('should allow valid sequential lifecycle transitions', () => {
    expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.PREPARING)).toBe(true);
    expect(canTransition(DeploymentStatus.PREPARING, DeploymentStatus.BUILDING)).toBe(true);
    expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.DEPLOYING)).toBe(true);
    expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.HEALTH_CHECKING)).toBe(true);
    expect(canTransition(DeploymentStatus.HEALTH_CHECKING, DeploymentStatus.SUCCEEDED)).toBe(true);
  });

  it('should allow cancellation and failure from active states', () => {
    expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.CANCELLED)).toBe(true);
    expect(canTransition(DeploymentStatus.BUILDING, DeploymentStatus.FAILED)).toBe(true);
    expect(canTransition(DeploymentStatus.DEPLOYING, DeploymentStatus.FAILED)).toBe(true);
  });

  it('should reject invalid and backwards transitions', () => {
    expect(canTransition(DeploymentStatus.SUCCEEDED, DeploymentStatus.BUILDING)).toBe(false);
    expect(canTransition(DeploymentStatus.FAILED, DeploymentStatus.QUEUED)).toBe(false);
    expect(canTransition(DeploymentStatus.CANCELLED, DeploymentStatus.PREPARING)).toBe(false);
    expect(canTransition(DeploymentStatus.QUEUED, DeploymentStatus.DEPLOYING)).toBe(false);
  });

  it('should ensure terminal states have no permissible outbound transitions', () => {
    expect(ALLOWED_STATE_TRANSITIONS[DeploymentStatus.SUCCEEDED]).toHaveLength(0);
    expect(ALLOWED_STATE_TRANSITIONS[DeploymentStatus.FAILED]).toHaveLength(0);
    expect(ALLOWED_STATE_TRANSITIONS[DeploymentStatus.CANCELLED]).toHaveLength(0);
  });
});
