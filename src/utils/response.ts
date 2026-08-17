export const successResponse = (data: any, message: string = 'Success') => {
  return {
    success: true,
    message,
    data,
  };
};

export const errorResponse = (message: string, code: number = 500) => {
  return {
    success: false,
    message,
    error: {
      code,
    },
  };
};
