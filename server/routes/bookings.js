const express = require('express');
const router = express.Router();
const bookingService = require('../services/bookingService');
const Booking = require('../models/Booking');

/**
 * GET /api/bookings/stats/today
 * Returns dashboard metrics for today's bookings
 */
router.get('/stats/today', async (req, res) => {
  try {
    const allBookings = await bookingService.listBookings({ limit: 500 });
    const todayStr = new Date().toISOString().split('T')[0];

    const todayBookings = allBookings.filter((b) => {
      const bDate = b.appointment?.date || b.date;
      return bDate === todayStr || !bDate;
    });

    const total = todayBookings.length;
    const whatsapp = todayBookings.filter((b) => b.channel === 'whatsapp').length;
    const voice = todayBookings.filter((b) => b.channel === 'voice').length;
    const confirmed = todayBookings.filter((b) => b.status === 'confirmed').length;
    const collecting = todayBookings.filter((b) => b.status === 'collecting').length;

    const revenue = todayBookings
      .filter((b) => b.status === 'confirmed')
      .reduce((sum, b) => sum + (b.appointment?.estimatedPrice || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        total,
        whatsapp,
        voice,
        confirmed,
        collecting,
        revenue,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/bookings
 * Returns bookings list (supports limit=50, channel, status, date query filters)
 */
router.get('/', async (req, res) => {
  try {
    const bookings = await bookingService.listBookings(req.query);
    res.status(200).json({
      success: true,
      count: bookings.length,
      data: bookings,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/bookings/:id
 * Fetch single booking by ID or bookingId
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let booking = null;

    try {
      booking = (await Booking.findById(id)) || (await Booking.findOne({ bookingId: id }));
    } catch (e) {
      const all = await bookingService.listBookings({ limit: 200 });
      booking = all.find((b) => b._id === id || b.bookingId === id);
    }

    if (!booking) {
      return res.status(404).json({ success: false, error: 'Booking not found' });
    }

    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/bookings
 * Manually create a booking
 */
router.post('/', async (req, res) => {
  try {
    const newBooking = await bookingService.createBooking(req.body);
    res.status(201).json({ success: true, data: newBooking });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * PATCH /api/bookings/:id
 * Update booking status or fields
 */
router.patch('/:id', async (req, res) => {
  try {
    const updated = await bookingService.updateBooking(req.params.id, req.body);
    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/bookings/:id
 * Soft delete: set status = "cancelled"
 */
router.delete('/:id', async (req, res) => {
  try {
    const cancelled = await bookingService.updateBooking(req.params.id, { status: 'cancelled' });
    res.status(200).json({ success: true, message: 'Booking cancelled successfully', data: cancelled });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

module.exports = router;
