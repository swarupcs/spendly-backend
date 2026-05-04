import type { Request, Response } from 'express';
import { prisma } from '../config/db';
import { env } from '../config/env';

export async function getUserDetails(req: Request, res: Response) {
  try {
    const userId = parseInt(req.params.id as string, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        settings: true,
        expenses: {
          orderBy: { date: 'desc' },
          take: 50
        },
        chatMessages: {
          orderBy: { createdAt: 'desc' },
          take: 100
        },
        toolCallLogs: {
          orderBy: { createdAt: 'desc' },
          take: 100
        },
        _count: {
          select: {
            expenses: true,
            chatMessages: true,
            toolCallLogs: true
          }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    res.json({ success: true, data: user });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getUsers(req: Request, res: Response) {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        isActive: true,
        settings: {
          select: {
            llmProvider: true,
            llmModel: true,
          }
        },
        _count: {
          select: {
            expenses: true,
            chatMessages: true,
            toolCallLogs: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: users });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getGlobalSettings(req: Request, res: Response) {
  try {
    let settings = await prisma.globalSettings.findFirst();
    if (!settings) {
      settings = await prisma.globalSettings.create({
        data: { llmProvider: env.LLM_PROVIDER, llmModel: '' }
      });
    }
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateGlobalSettings(req: Request, res: Response) {
  try {
    const { llmProvider, llmModel } = req.body;
    let settings = await prisma.globalSettings.findFirst();
    
    if (!settings) {
      settings = await prisma.globalSettings.create({
        data: { llmProvider, llmModel }
      });
    } else {
      settings = await prisma.globalSettings.update({
        where: { id: settings.id },
        data: { llmProvider, llmModel }
      });
    }
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateUserSettings(req: Request, res: Response) {
  try {
    const userId = parseInt((req.params.id as string) || '0');
    const { llmProvider, llmModel } = req.body;
    
    const settings = await prisma.userSettings.upsert({
      where: { userId },
      update: { llmProvider, llmModel },
      create: { userId, llmProvider, llmModel }
    });
    
    res.json({ success: true, data: settings });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}
