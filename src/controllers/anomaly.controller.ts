import { Request, Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types/index';
import { getActiveAnomaliesService, dismissAnomalyService, detectAnomalies } from '../services/anomaly.service';

export async function getAnomalies(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    
    // For MVP, we'll trigger detection on fetch if desired, 
    // or rely on a cron. Here we can just run it inline for immediate feedback.
    await detectAnomalies(userId);

    const anomalies = await getActiveAnomaliesService(userId);
    res.json({ success: true, data: anomalies });
  } catch (err) {
    next(err);
  }
}

export async function dismissAnomaly(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const userId = (req as AuthenticatedRequest).user.sub;
    const anomalyId = parseInt(String(req.params.id), 10);
    
    if (isNaN(anomalyId)) {
      res.status(400).json({ success: false, error: 'Invalid anomaly ID' });
      return;
    }

    const anomaly = await dismissAnomalyService(userId, anomalyId);
    res.json({ success: true, data: anomaly });
  } catch (err) {
    next(err);
  }
}
