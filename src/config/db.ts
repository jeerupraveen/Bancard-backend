import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/bancard';
        await mongoose.connect(MONGODB_URI);
        console.log('MongoDB Connected...');
    } catch (err: any) {
        console.error(err.message);
        // Exit process with failure
        process.exit(1);
    }
};

export default connectDB;
