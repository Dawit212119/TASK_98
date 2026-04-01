import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateCsvExportDto } from '../src/modules/analytics/dto/create-csv-export.dto';

describe('AnalyticsService CSV export', () => {
  it('rejects unsupported report_type at DTO validation layer', () => {
    const dto = plainToInstance(CreateCsvExportDto, {
      report_type: 'unsupported_type',
      filters: {},
      columns: ['metric', 'value']
    });

    const errors = validateSync(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(JSON.stringify(errors)).toContain('report_type');
  });
});
