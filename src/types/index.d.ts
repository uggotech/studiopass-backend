import { TUser } from 'module/user/user.interface';

declare global {
  namespace Express {
    interface Request {
      user?: TUser;
    }
  }
}
