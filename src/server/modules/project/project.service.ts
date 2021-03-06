import {Injectable, NotFoundException} from '@nestjs/common';
import {InjectRepository} from '@nestjs/typeorm';
import {EntityManager, Repository, Transaction, TransactionManager} from 'typeorm';
import * as R from 'ramda';

import {Project, CompilerInput} from './entities';
import {TagService} from '../tag/tag.service';
import {CreateTagDto} from '../tag/dto/CreateTag.dto';
import {CreateProjectDto} from './dto';
import {paginate, PaginationOptions, PaginationResult} from '../shared/pagination';

@Injectable()
export class ProjectService {
  constructor(
    @InjectRepository(Project)
    private projectRepository: Repository<Project>,
    private tagService: TagService,
  ) {}

  /**
   * Deletes project by id
   *
   * @param {number} id
   * @memberof ProjectService
   */
  @Transaction()
  async delete(id: number, @TransactionManager() manager?: EntityManager) {
    const {projectRepository} = this;

    const project = await projectRepository.findOne(id);
    if (!project)
      throw new NotFoundException;

    await manager.delete(CompilerInput, project.inputId);
    await manager.delete(Project, project.id);
  }

  /**
   * Creates single project
   *
   * @param {CreateProjectDto} dto
   * @param {EntityManager} [manager]
   * @returns {Promise<Project>}
   * @memberof ProjectService
   */
  @Transaction()
  async create(dto: CreateProjectDto, @TransactionManager() manager?: EntityManager): Promise<Project> {
    const input = new CompilerInput(
      {
        language: dto.input.language,
        code: dto.input.code,
      },
    );

    const project = new Project(
      {
        title: dto.title,
        description: dto.description,
        tags: await this.tagService.createListIfNotExist(
          dto.tags.map((tag) => new CreateTagDto(
            {
              name: tag,
            },
          )),
        ),
        input,
      },
    );

    await manager.save(input);
    return manager.save(project);
  }

  /**
   * Search single record by id
   *
   * @param {number} id
   * @returns {Promise<Project>}
   * @memberof ProjectService
   */
  find(id: number): Promise<Project> {
    return this.projectRepository.findOne(id, {relations: ['input', 'tags']});
  }

  /**
   * Finds one record by its title
   *
   * @param {string} name
   * @returns {Promise<Project>}
   * @memberof ProjectService
   */
  findByTitle(title: string): Promise<Project> {
    if (R.isNil(title))
      return null;

    return this.projectRepository.findOne(
      {
        where: {
          title,
        },
      },
    );
  }

  /**
   * List all projects
   *
   * @param {PaginationOptions} options
   * @returns {Promise<PaginationResult<Project>>}
   * @memberof ProjectService
   */
  findAll(options: PaginationOptions): Promise<PaginationResult<Project>> {
    return paginate(
      this.projectRepository,
      {
        ...options,
        relations: ['tags'],
      },
    );
  }
}
