import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

const connectDB = async () => {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bancard';
        await mongoose.connect(MONGODB_URI);
        logger.info('MongoDB connected');
    } catch (err: any) {
        logger.error('MongoDB connection failed', err);
        // Exit process with failure
        process.exit(1);
    }
};

export default connectDB;
