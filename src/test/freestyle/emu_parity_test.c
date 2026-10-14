// Compares the fork's ported filters against EmuFlight's original algorithms
// (copied below, adapted only to take explicit state) on a synthetic gyro trace.
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "platform.h"
#include "common/filter.h"
#include "common/maths.h"
#include "freestyle/kalman.h"
#include "freestyle/abg_filter.h"
#include "freestyle/smith_predictor.h"

/* ---------- EmuFlight reference: kalman.c ---------- */
typedef struct { float q,r,p,k,x,lastX,e,axisVar; uint16_t windex; float axisWindow[513], varianceWindow[513];
  float axisSumMean, axisMean, axisSumVar, inverseN; uint16_t w; pt1Filter_t kFilter; } emuKalman_t;
static void emuKalmanInit(emuKalman_t *f, float q, uint16_t w, float dT) {
  memset(f,0,sizeof(*f)); f->q=q*0.0001f; f->r=88.0f; f->p=30.0f; f->e=1.0f; f->w=w; f->inverseN=1.0f/(float)w;
  pt1FilterInit(&f->kFilter, pt1FilterGain(50, dT)); }
static void emuUpdateCov(emuKalman_t *k, float rate) {
  k->axisWindow[k->windex]=rate; k->axisSumMean+=k->axisWindow[k->windex];
  float v=k->axisWindow[k->windex]-k->axisMean; v=v*v; k->axisSumVar+=v; k->varianceWindow[k->windex]=v;
  k->windex++; if (k->windex>k->w) k->windex=0;
  k->axisSumMean-=k->axisWindow[k->windex]; k->axisSumVar-=k->varianceWindow[k->windex];
  k->axisMean=k->axisSumMean*k->inverseN; k->axisVar=k->axisSumVar*k->inverseN;
  k->r=sqrtf(fmaxf(k->axisVar,0.0f)); }
static float emuKalmanProcess(emuKalman_t *s, float input) {
  s->x+=(s->x-s->lastX)*s->k; s->lastX=s->x;
  float e=constrainf(s->r/45.0f+0.005f,0.005f,0.9f); e=-powf(e-1.0f,2)*0.7f+(e-1.0f)*(1.0f-0.7f)+1.0f; s->e=e;
  s->p=s->p+(s->q*s->e); s->k=s->p/(s->p+10.0f); s->k=pt1FilterApply(&s->kFilter,s->k);
  s->x+=s->k*(input-s->x); s->p=(1.0f-s->k)*s->p; return s->x; }

/* ---------- EmuFlight reference: ABG ---------- */
typedef struct { float a,b,g,e,ak,vk,xk,jk,rk,dT,dT2,dT3,halfLife,boost; pt1Filter_t boostFilter,velFilter,accFilter,jerkFilter; } emuAbg_t;
static void emuABGInit(emuAbg_t *f, float alpha, int boostGain, int halfLife, float dT) {
  const float A=alpha*0.001f; const float xi=powf(-A+1.0f,0.25);
  f->xk=f->vk=f->ak=f->jk=0; f->a=A; f->b=(1.0f/6.0f)*powf(1.0f-xi,2)*(11.0f+14.0f*xi+11*xi*xi);
  f->g=2*powf(1.0f-xi,3)*(1+xi); f->e=(1.0f/6.0f)*powf(1-xi,4); f->dT=dT; f->dT2=dT*dT; f->dT3=dT*dT*dT;
  pt1FilterInit(&f->boostFilter,pt1FilterGain(100,dT)); pt1FilterInit(&f->velFilter,pt1FilterGain(75,dT));
  pt1FilterInit(&f->accFilter,pt1FilterGain(50,dT)); pt1FilterInit(&f->jerkFilter,pt1FilterGain(25,dT));
  f->boost=(boostGain*boostGain/1000000)*0.003; f->halfLife=halfLife!=0?powf(0.5f,dT/(halfLife/100.0f)):1.0f; }
static float emuABGApply(emuAbg_t *f, float input) {
  float rk; f->xk*=f->halfLife; f->vk*=f->halfLife; f->ak*=f->halfLife; f->jk*=f->halfLife;
  f->xk+=f->dT*f->vk+(1.0f/2.0f)*f->dT2*f->ak+(1.0f/6.0f)*f->dT3*f->jk;
  f->vk+=f->dT*f->ak+0.5f*f->dT2*f->jk; f->ak+=f->dT*f->jk; rk=input-f->xk;
  rk+=pt1FilterApply(&f->boostFilter,(fabsf(rk)*rk*f->boost)); f->rk=rk;
  f->xk+=f->a*rk; f->vk+=f->b/f->dT*rk; f->ak+=f->g/(2.0f*f->dT2)*rk; f->jk+=f->e/(6.0f*f->dT3)*rk;
  f->vk=pt1FilterApply(&f->velFilter,f->vk); f->ak=pt1FilterApply(&f->accFilter,f->ak); f->jk=pt1FilterApply(&f->jerkFilter,f->jk);
  return f->xk; }

/* ---------- EmuFlight reference: Smith predictor (as intended, per axis) ---------- */
typedef struct { uint8_t enabled, samples, idx; float data[385]; pt1Filter_t f; float str; } emuSmith_t;
static float emuSmithApply(emuSmith_t *s, float g) {
  if (s->samples>1 && s->enabled) { s->data[s->idx]=g; s->idx++; if (s->idx>s->samples) s->idx=0;
    float d=s->data[s->idx]; float c=s->str*(g-d); c=pt1FilterApply(&s->f,c); g+=c; } return g; }

#define N 40000
static float sig[N];

static double maxdiff(const float *a, const float *b) { double m=0; for (int i=0;i<N;i++) m=fmax(m,fabs(a[i]-b[i])); return m; }

int main(void) {
  const uint32_t looptimeUs = 125; const float dT = looptimeUs*1e-6f;
  srand(1);
  for (int i=0;i<N;i++) { float t=i*dT;
    sig[i]= 300*sinf(2*M_PI*3*t) + (t>2.0f && t<2.2f ? 800 : 0)        // stick moves + a flip-like step
          + 40*sinf(2*M_PI*240*t) + 15*sinf(2*M_PI*410*t)              // motor noise
          + 10*((float)rand()/RAND_MAX-0.5f); }                           // broadband noise
  static float outA[N], outB[N];
  int fail = 0;

  // Kalman: q=6000, w=32 (EmuFlight defaults); covariance fed with the output (no other filters)
  { freestyleKalman_t k; emuKalman_t e;
    freestyleKalmanInit(&k, 6000, 32, dT); emuKalmanInit(&e, 6000, 32, dT);
    for (int i=0;i<N;i++) { outA[i]=freestyleKalmanApply(&k,sig[i]); freestyleKalmanUpdateVariance(&k,outA[i]);
                            outB[i]=emuKalmanProcess(&e,sig[i]); emuUpdateCov(&e,outB[i]); }
    double d=maxdiff(outA,outB); printf("kalman   max |fork-emu| = %.6f dps\n", d); fail |= d > 0.01; }

  // ABG: boost 0 and 2000 agree between the two (EmuFlight's integer math is
  // exact there); boost 275 shows the bug fix: EmuFlight had boost == 0.
  int boosts[] = {0, 2000, 275};
  for (int bi=0; bi<3; bi++) { abgFilter_t a; emuAbg_t e;
    abgFilterInit(&a, 300, boosts[bi], 50, dT); emuABGInit(&e, 300, boosts[bi], 50, dT);
    for (int i=0;i<N;i++) { outA[i]=abgFilterApply((filter_t*)&a,sig[i]); outB[i]=emuABGApply(&e,sig[i]); }
    double d=maxdiff(outA,outB);
    printf("abg      boost=%4d max |fork-emu| = %.6f dps  (fork boost=%g, emu boost=%g)\n", boosts[bi], d, a.boost, e.boost);
    if (boosts[bi] != 275) fail |= d > 0.01; }

  // Smith: default str 50, delay 40 (4ms), filt 5Hz
  { smithPredictor_t s; emuSmith_t e; memset(&e,0,sizeof(e));
    smithPredictorInit(&s, true, 50, 40, 5, looptimeUs);
    e.enabled=1; e.samples=(uint8_t)(40/(looptimeUs/100.0f)); e.str=0.5f; pt1FilterInit(&e.f, pt1FilterGain(5, dT));
    for (int i=0;i<N;i++) { outA[i]=smithPredictorApply(&s,sig[i]); outB[i]=emuSmithApply(&e,sig[i]); }
    double d=maxdiff(outA,outB); printf("smith    samples fork=%u emu=%u  max |fork-emu| = %.6f dps\n", s.samples, e.samples, d); fail |= d > 0.01;
    // clamp check: 12ms at 32kHz would have overflowed EmuFlight's uint8 count
    smithPredictorInit(&s, true, 50, 120, 5, 31); printf("smith    12ms @ 32kHz -> %u samples (max %u)\n", s.samples, FREESTYLE_SMITH_MAX_SAMPLES);
    fail |= s.samples > FREESTYLE_SMITH_MAX_SAMPLES; }

  // Kalman window clamp
  { freestyleKalman_t k; freestyleKalmanInit(&k, 6000, 512, dT); printf("kalman   w=512 clamped to %u\n", k.w); fail |= k.w != FREESTYLE_KALMAN_MAX_WINDOW; }

  printf(fail ? "FAIL\n" : "PASS\n");
  return fail;
}
